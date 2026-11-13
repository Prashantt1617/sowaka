// Pieces the Leave requests and Overtime pages share: the day-by-day bars, the
// period picker, the Needs action panel, the Pending chip and the stat tiles.
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { LoadingFigure, Pill } from '../ui';
import { TO_STAT, typeColor } from '../theme';
import type { Leave } from '../seed';
import { PersonAvatar } from '../PersonAvatar';
import type { LoadState } from '../ui';
import { btn, btnClass, cellName, cellSub, SEG, segBtn, TILE, TR } from '../ds';
import { APPROVED_FILL, dateOf, dayLabel, isWeekend, LEAVE_COLS, PENDING_FILL, PENDING_ROW, SECOND_FILL } from './leaveDays';
import type { PeriodId } from './leaveDays';

export function Swatch({ kind }: { kind: 'approved' | 'pending' | 'holiday' | 'second' }) {
  if (kind === 'holiday') return <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)', display: 'inline-block' }} />;
  return <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, display: 'inline-block', ...(kind === 'pending' ? PENDING_FILL : { background: kind === 'second' ? SECOND_FILL : APPROVED_FILL }) }} />;
}

// "attn" is the Time office's needs-attention tint (a calm blue); red only where it is bad.
const FLAG: Record<'bad' | 'attn' | 'mute', CSSProperties> = {
  bad: { background: 'var(--bad-bg)', color: 'var(--bad)' },
  attn: { background: 'var(--attn-bg)', color: 'var(--attn)' },
  mute: { background: 'var(--mute-bg)', color: 'var(--ink-2)' },
};
type FlagTone = keyof typeof FLAG;
/** Filter tags in the dashboard's solid status-pill colours: red passed, yellow waiting, grey the rest. */
const TAG_TONE: Record<FlagTone, { bg: string; fg: string }> = { bad: TO_STAT.Declined, attn: TO_STAT.Pending, mute: TO_STAT.Cancelled };
/** A small coloured label: the header counts (round) or a row's flag (small, squarer). */
const chip = (tone: FlagTone, small = false): CSSProperties => ({
  ...FLAG[tone],
  display: 'inline-block',
  alignSelf: 'flex-start',
  fontSize: small ? 11.5 : 12.5,
  fontWeight: 500,
  padding: small ? '2px 8px' : '4px 10px',
  borderRadius: small ? 6 : 999,
  whiteSpace: 'nowrap',
});

/** A row's flag: "Date passed, still pending", "Starts in 4 days". */
export function Flag({ tone, children }: { tone: FlagTone; children: ReactNode }) {
  return <span style={chip(tone, true)}>{children}</span>;
}

/** A text button in the accent colour: "View all", "Open calendar". */
export function LinkButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return <button type="button" onClick={onClick} style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13.5, fontWeight: 500, color: 'var(--accent-ink)' }}>{children}</button>;
}

/** "Pending ›": a pending request's status, which opens it to decide. */
export function PendingChip({ onClick, label }: { onClick: () => void; label: string; dot?: boolean }) {
  // The live dashboard's Pending pill exactly (the shared Pill: solid yellow, a dot, 11.5px), clickable.
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{ border: 0, padding: 0, background: 'none', cursor: 'pointer', font: 'inherit', lineHeight: 0 }}
    >
      <Pill label="Pending" tone={TO_STAT.Pending} />
    </button>
  );
}

/** The "Needs action" panel, in the attention tint: a heading, a summary line, count chips, then rows. */
export function NeedsActionShell({ id, state, summary, chips, children, more }: {
  id: string;
  state: LoadState;
  summary: ReactNode;
  /** A chip with `onPick` is a filter on the list: its count sits in a badge, the one on is outlined. */
  chips: { tone: FlagTone; text: string; count?: number; onPick?: () => void; picked?: boolean }[];
  children: ReactNode;
  more?: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} style={{ ...TILE, padding: 0, gap: 0, minHeight: 0, overflow: 'hidden', marginBottom: 20, scrollMarginTop: 96 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 22px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 }}>
          <h2 id={`${id}-h`} style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Needs action</h2>
          <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}><LoadingFigure state={state} w={140} h={14}>{summary}</LoadingFigure></span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {chips.map((c) => {
            if (!c.onPick) return <span key={c.text} style={chip(c.tone)}>{c.text}</span>;
            // A filter tag, drawn as the dashboard's status pills: solid, a dot, its count in a badge.
            const tone = TAG_TONE.mute;
            return (
              <button key={c.text} type="button" aria-pressed={c.picked}
                onClick={() => c.onPick?.()}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '3px 4px 3px 10px', borderRadius: 99, border: '1px solid var(--line)', cursor: 'pointer', font: 'inherit', lineHeight: 1.5, whiteSpace: 'nowrap',
                  background: 'var(--surface)', color: 'var(--ink)', boxShadow: c.picked ? 'inset 0 0 0 1.5px var(--ink-2)' : undefined, fontWeight: c.picked ? 600 : 500 }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: '50%', background: tone.bg }} />
                {c.text}
                {c.count != null && <span style={{ minWidth: 20, padding: '0 6px', borderRadius: 999, background: tone.bg, color: tone.fg, fontWeight: 700, fontSize: 11.5, lineHeight: '18px', textAlign: 'center' }}>{c.count}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 760 }}>{children}</div>
      </div>
      {more && <div style={{ padding: '12px 22px', borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>{more}</div>}
    </section>
  );
}


/** "Waiting": days since it was submitted, bold at the limit and red past it. */
export function Waiting({ days, slow }: { days: number; slow: number }) {
  const color = days > slow ? 'var(--bad)' : days === slow ? 'var(--attn)' : 'var(--ink)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={cellSub}>Waiting</span>
      <span style={{ fontSize: 13.5, fontWeight: days >= slow ? 600 : 400, color }}>{days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'}`}</span>
    </div>
  );
}

/** A period header: ‹ title › to step back and forward, and This week / This month to pick the size. */
export function PeriodStepper({ id, title, unit, onUnit, onStep, hasPrev = true, hasNext = true }: { id: string; title: string; unit: 'week' | 'month'; onUnit: (u: 'week' | 'month') => void; onStep: (by: -1 | 1) => void; hasPrev?: boolean; hasNext?: boolean }) {
  const arrow: CSSProperties = { width: 36, height: 36, borderRadius: '50%', border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', cursor: 'pointer', font: 'inherit', fontSize: 18, lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" aria-label={`Previous ${unit}`} onClick={() => onStep(-1)} disabled={!hasPrev} aria-hidden={!hasPrev} style={{ ...arrow, visibility: hasPrev ? 'visible' : 'hidden' }}>‹</button>
        <h2 id={id} style={{ margin: 0, fontSize: 16, fontWeight: 600, minWidth: 150, textAlign: 'center' }}>{title}</h2>
        <button type="button" aria-label={`Next ${unit}`} onClick={() => onStep(1)} disabled={!hasNext} aria-hidden={!hasNext} style={{ ...arrow, visibility: hasNext ? 'visible' : 'hidden' }}>›</button>
      </div>
      <PeriodButtons periods={[['week', 'This week'], ['month', 'This month']]} period={unit} onPeriod={(p) => onUnit(p === 'week' ? 'week' : 'month')} />
    </div>
  );
}

/** The period buttons. */
export function PeriodButtons({ periods, period, onPeriod }: { periods: [PeriodId, string][]; period: PeriodId; onPeriod: (p: PeriodId) => void }) {
  return (
    <div role="group" aria-label="Period" style={SEG}>
      {periods.map(([id, label]) => (
        <button key={id} type="button" aria-pressed={period === id} onClick={() => onPeriod(id)} style={segBtn(period === id)}>{label}</button>
      ))}
    </div>
  );
}

/** The from/to picker shown under the period buttons when Custom is on. */
export function CustomRange({ applied, draftFrom, draftTo, onDraftFrom, onDraftTo, onApply, error, hint, max }: {
  applied: boolean;
  draftFrom: string;
  draftTo: string;
  onDraftFrom: (v: string) => void;
  onDraftTo: (v: string) => void;
  onApply: () => void;
  error: string;
  hint: string;
  max?: string;
}) {
  const input: CSSProperties = { height: 40, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 10, font: 'inherit', fontSize: 13.5, background: 'var(--surface)', color: 'var(--ink)' };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, padding: 16, borderRadius: 14, background: 'var(--accent-soft)', border: '1px solid var(--accent-line)' }}>
      <span style={{ flex: '1 1 100%', fontSize: 13.5, fontWeight: 500, color: 'var(--accent-ink)' }}>{applied ? 'Change the dates and apply again to see a different range.' : hint}</span>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>From<input type="date" max={max} value={draftFrom} onChange={(e) => onDraftFrom(e.target.value)} style={input} /></label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--ink-2)' }}>To<input type="date" max={max} value={draftTo} onChange={(e) => onDraftTo(e.target.value)} style={input} /></label>
      <button type="button" onClick={onApply} className={btnClass('dark')} style={btn('dark')}>Apply</button>
      {error && <span role="alert" style={{ flex: '1 1 100%', fontSize: 12.5, color: 'var(--bad)' }}>{error}</span>}
    </div>
  );
}

const statTile: CSSProperties = { border: '1px solid var(--line)', borderRadius: 16, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };
const statNum: CSSProperties = { fontSize: 26, fontWeight: 400, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' };
/** One figure in a period's summary; `attn` is the Pending tile, in the attention tint. */
export function StatTile({ label, value, unit, sub, state, attn, action, onPick, picked, color }: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  state: LoadState;
  attn?: boolean;
  action?: ReactNode;
  /** A tile that filters the list below it, as the Company calendar's chips do; `picked` when it is the filter on. */
  onPick?: () => void;
  picked?: boolean;
  /** The tile's own colour, for its border and tint when picked. */
  color?: string;
}) {
  const tone = color ?? 'var(--ink-2)';
  return (
    <div
      {...(onPick ? { role: 'button', tabIndex: 0, 'aria-pressed': picked, onClick: onPick, onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } } } : {})}
      style={{
        ...statTile,
        ...(attn ? { background: 'var(--attn-bg)', border: '1px solid var(--attn-line)' } : null),
        ...(onPick ? { cursor: 'pointer' } : null),
        ...(picked ? { border: `1.5px solid ${tone}`, background: `linear-gradient(135deg, color-mix(in srgb, ${tone} 22%, var(--surface)), color-mix(in srgb, ${tone} 5%, var(--surface)))` } : null),
      }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ ...cellSub, fontSize: 12.5, color: attn ? 'var(--attn)' : 'var(--ink-3)' }}>{label}</span>
        {action}
      </div>
      <span style={statNum}>
        <LoadingFigure state={state}>{value}{unit && <span style={{ fontSize: 15, color: 'var(--ink-3)' }}> {unit}</span>}</LoadingFigure>
      </span>
      {sub != null && <span style={{ fontSize: 12.5, color: attn ? 'var(--attn)' : 'var(--ink-3)' }}>{sub}</span>}
    </div>
  );
}

/**
 * A count per day as stacked bars: the decided part solid (optionally split in
 * two, `a` then `c` above it), pending hatched on top. Days after today can be
 * shaded as not yet happened; `marks` puts a dot under a day (a holiday).
 */
export function DayBars({ days, totals, today, onPick, selected, height = 120, words = ['approved', 'pending'], shadeFuture = false, marks }: {
  days: string[];
  totals: { a: number; p: number; c?: number }[];
  today: string;
  onPick?: (iso: string) => void;
  selected?: string;
  height?: number;
  /** What a, p and (when given) c are called in each day's tooltip. */
  words?: [string, string] | [string, string, string];
  shadeFuture?: boolean;
  marks?: Map<string, string>;
}) {
  const max = Math.max(1, ...totals.map((t) => t.a + t.p + (t.c ?? 0)));
  const n = days.length;
  const track: CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 4 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: n > 10 ? Math.max(760, n * 26) : 420, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ ...track, alignItems: 'end', height: height + 40 }}>
          {days.map((d, i) => {
            const { a, p } = totals[i];
            const c = totals[i].c ?? 0;
            const wk = isWeekend(d);
            const on = selected === d;
            const future = shadeFuture && d > today;
            const mark = marks?.get(d);
            const label = `${dayLabel(d)}${mark ? ` (${mark})` : ''}: ${a} ${words[0]}${words[2] ? `, ${c} ${words[2]}` : ''}, ${p} ${words[1]}`;
            const past = !shadeFuture && d < today ? 0.55 : 1;
            const body = (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', color: 'var(--ink)' }}>{a + p + c || ''}</span>
                {p > 0 && <span style={{ display: 'block', height: Math.round((p / max) * height), borderRadius: a || c ? '3px 3px 0 0' : 3, ...PENDING_FILL }} />}
                {c > 0 && <span style={{ display: 'block', height: Math.round((c / max) * height), background: SECOND_FILL, opacity: past, borderRadius: p ? (a ? 0 : '0 0 3px 3px') : a ? '3px 3px 0 0' : 3 }} />}
                {a > 0 && <span style={{ display: 'block', height: Math.round((a / max) * height), background: APPROVED_FILL, opacity: past, borderRadius: p || c ? '0 0 3px 3px' : 3 }} />}
              </>
            );
            const bg = on ? 'var(--accent-soft)' : future ? 'repeating-linear-gradient(0deg, var(--surface-2) 0 4px, var(--surface) 4px 8px)' : wk ? 'var(--surface-2)' : 'transparent';
            const col: CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 0, borderRadius: 6, padding: '2px 1px 0', background: bg };
            return onPick ? (
              <button key={d} type="button" title={label} aria-label={label} aria-pressed={on} onClick={() => onPick(d)} style={{ ...col, border: on ? '2px solid var(--ink)' : '2px solid transparent', cursor: 'pointer', font: 'inherit' }}>{body}</button>
            ) : (
              <div key={d} title={label} style={col}>{body}</div>
            );
          })}
        </div>
        <div style={track}>
          {days.map((d) => {
            const dt = dateOf(d);
            const isToday = d === today;
            const dim = isWeekend(d) || (shadeFuture && d > today);
            return (
              <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <span style={isToday ? { fontSize: 11, fontWeight: 700, color: 'var(--on-sel)', background: 'var(--sel)', borderRadius: 999, padding: '0 5px' } : { fontSize: 11, fontWeight: 500, color: dim ? 'var(--ink-3)' : 'var(--ink)' }}>{dt.getDate()}</span>
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{WD1[dt.getDay()]}</span>
                {marks && <span aria-hidden title={marks.get(d)} style={{ width: 6, height: 6, borderRadius: '50%', background: marks.has(d) ? 'var(--ink)' : 'transparent' }} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** One leave in a table: pending rows tinted, with a Pending chip that opens it. */
export function LeaveRow({ r, last, onOpen }: { r: Leave; last: boolean; onOpen: () => void }) {
  const pend = r.status === 'Pending';
  // An approved leave its employee asked to cancel waits on a decision too.
  const cancelAsked = r.cancelRequest?.status === 'Pending';
  return (
    <div className="dc-row" onClick={onOpen} style={{ ...TR(LEAVE_COLS, last), position: 'relative', cursor: 'pointer', ...(pend || cancelAsked ? PENDING_ROW : null) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <PersonAvatar name={r.name} userId={r.submitterId} />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ ...cellName, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
          <div style={cellSub}>{r.team}</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: typeColor(r.type) }} />
        <span>{r.type}</span>
      </div>
      <div style={{ whiteSpace: 'nowrap' }}>{r.from === r.to ? r.from : `${r.from} – ${r.to}`}</div>
      <div style={{ whiteSpace: 'nowrap' }}>{r.days}</div>
      <div style={{ color: r.eRemark ? 'var(--ink)' : 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.eRemark || ''}>{r.eRemark || '—'}</div>
      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.manager}</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
        {pend
          ? <PendingChip onClick={onOpen} label={`Review ${r.name}'s leave request`} />
          : <Pill label={r.statusLabel} tone={TO_STAT[r.status]} />}
        {!pend && r.byAdmin && r.status !== 'Cancelled' && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>by admin</span>}
        {cancelAsked && <Pill label="Cancellation requested" tone={TO_STAT.Pending} />}
      </div>
      <div style={{ textAlign: 'right', color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>{r.applied}</div>
    </div>
  );
}

/**
 * Counts per day stacked by kind (punch-out missed, punch-in missed…), each
 * kind its own colour, bottom to top in the order given.
 */
export function StackBars({ days, series, today, height = 120, shadeFuture = true }: {
  days: string[];
  series: { label: string; color: string; values: number[] }[];
  today: string;
  height?: number;
  shadeFuture?: boolean;
}) {
  const totals = days.map((_, i) => series.reduce((a, s) => a + (s.values[i] ?? 0), 0));
  const max = Math.max(1, ...totals);
  const n = days.length;
  const track: CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 4 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: n > 10 ? Math.max(760, n * 26) : 420, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ ...track, alignItems: 'end', height: height + 40 }}>
          {days.map((d, i) => {
            const future = shadeFuture && d > today;
            const title = `${dayLabel(d)}: ${series.map((s) => `${s.values[i] ?? 0} ${s.label.toLowerCase()}`).join(', ')}`;
            const shown = series.filter((s) => (s.values[i] ?? 0) > 0).reverse();
            return (
              <div key={d} title={title} style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', borderRadius: 6, padding: '2px 1px 0', background: future ? 'repeating-linear-gradient(0deg, var(--surface-2) 0 4px, var(--surface) 4px 8px)' : isWeekend(d) ? 'var(--surface-2)' : 'transparent' }}>
                <span style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', color: 'var(--ink)' }}>{totals[i] || ''}</span>
                {shown.map((s, k) => (
                  <span key={s.label} style={{ display: 'block', height: Math.round(((s.values[i] ?? 0) / max) * height), background: s.color, borderRadius: shown.length === 1 ? 3 : k === 0 ? '3px 3px 0 0' : k === shown.length - 1 ? '0 0 3px 3px' : 0 }} />
                ))}
              </div>
            );
          })}
        </div>
        <div style={track}>
          {days.map((d) => {
            const dt = dateOf(d);
            const dim = isWeekend(d) || (shadeFuture && d > today);
            return (
              <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={d === today ? { fontSize: 11, fontWeight: 700, color: 'var(--on-sel)', background: 'var(--sel)', borderRadius: 999, padding: '0 5px' } : { fontSize: 11, fontWeight: 500, color: dim ? 'var(--ink-3)' : 'var(--ink)' }}>{dt.getDate()}</span>
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{WD1[dt.getDay()]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A legend entry: a colour swatch and its name. */
export function Key({ color, children }: { color: string; children: ReactNode }) {
  return <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block' }} />{children}</span>;
}

