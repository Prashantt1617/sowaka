import type { CSSProperties } from 'react';
import type { Leave } from '../seed';
import { APPROVED_FILL, dateOf, dayLabel, isWeekend, PENDING_FILL } from './leaveDays';

export function Swatch({ kind }: { kind: 'approved' | 'pending' | 'holiday' }) {
  if (kind === 'holiday') return <span aria-hidden style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ink)', display: 'inline-block' }} />;
  return <span aria-hidden style={{ width: 12, height: 12, borderRadius: 3, display: 'inline-block', ...(kind === 'pending' ? PENDING_FILL : { background: APPROVED_FILL }) }} />;
}

/** People off each day of the period, as stacked bars: approved solid, pending hatched. */
export function DayBars({ days, counts, today, onPick, selected, height = 120 }: {
  days: string[];
  counts: { approved: Leave[]; pending: Leave[] }[];
  today: string;
  onPick?: (iso: string) => void;
  selected?: string;
  height?: number;
}) {
  const people = (ls: Leave[]) => new Set(ls.map((l) => l.submitterId || l.name)).size;
  const totals = counts.map((c) => ({ a: people(c.approved), p: people(c.pending) }));
  const max = Math.max(1, ...totals.map((t) => t.a + t.p));
  const n = days.length;
  const track: CSSProperties = { display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 4 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: n > 10 ? Math.max(760, n * 26) : 420, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ ...track, alignItems: 'end', height: height + 40 }}>
          {days.map((d, i) => {
            const { a, p } = totals[i];
            const wk = isWeekend(d);
            const on = selected === d;
            const label = `${dayLabel(d)}: ${a} approved, ${p} pending`;
            const body = (
              <>
                <span style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', color: 'var(--ink)' }}>{a + p || ''}</span>
                {p > 0 && <span style={{ display: 'block', height: Math.round((p / max) * height), borderRadius: a ? '3px 3px 0 0' : 3, ...PENDING_FILL }} />}
                {a > 0 && <span style={{ display: 'block', height: Math.round((a / max) * height), background: APPROVED_FILL, opacity: d < today ? 0.55 : 1, borderRadius: p ? '0 0 3px 3px' : 3 }} />}
              </>
            );
            const col: CSSProperties = { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 0, borderRadius: 6, padding: '2px 1px 0', background: on ? 'var(--accent-soft)' : wk ? 'var(--surface-2)' : 'transparent' };
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
            return (
              <div key={d} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={isToday ? { fontSize: 11, fontWeight: 700, color: 'var(--on-sel)', background: 'var(--sel)', borderRadius: 999, padding: '0 5px' } : { fontSize: 11, fontWeight: 500, color: isWeekend(d) ? 'var(--ink-3)' : 'var(--ink)' }}>{dt.getDate()}</span>
                <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>{WD1[dt.getDay()]}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
const WD1 = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
