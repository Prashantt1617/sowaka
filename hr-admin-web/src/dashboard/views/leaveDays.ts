import type { CSSProperties } from 'react';
import type { Leave } from '../seed';

/** Calendar helpers for the leave pages: plain YYYY-MM-DD strings, local time. */

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
export const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const dateOf = (iso: string) => new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const addDays = (iso: string, n: number) => {
  const d = dateOf(iso);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
export const todayISO = () => isoOf(new Date());
/** Whole days from a to b (b later is positive). */
export const daysBetween = (a: string, b: string) => Math.round((dateOf(b).getTime() - dateOf(a).getTime()) / 86_400_000);

export const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "Wed 11 Nov". */
export const dayLabel = (iso: string) => {
  const d = dateOf(iso);
  return `${WD[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
};
export const isWeekend = (iso: string) => {
  const w = dateOf(iso).getDay();
  return w === 0 || w === 6;
};

/** Every day from a to b, both included. */
export function daysIn(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

export const startOf = (l: Leave) => (l.refISO || '').slice(0, 10);
export const endOf = (l: Leave) => ((l.endISO || l.refISO || '').slice(0, 10) || startOf(l));

const daysCache = new WeakMap<Leave, string[]>();
/**
 * The days a leave keeps someone off. When the span is longer than the days it
 * counts (a Friday to Monday leave of two days), the weekend is taken out.
 */
export function leaveDates(l: Leave): string[] {
  const hit = daysCache.get(l);
  if (hit) return hit;
  const start = startOf(l);
  let out = start ? daysIn(start, endOf(l) < start ? start : endOf(l)) : [];
  if (out.length > Math.ceil(l.dayN || 0)) {
    const working = out.filter((d) => !isWeekend(d));
    if (working.length) out = working;
  }
  daysCache.set(l, out);
  return out;
}

/** Does the leave touch the period at all? Empty bounds are open. */
export const overlaps = (l: Leave, from: string, to: string) => {
  const s = startOf(l);
  if (!s) return !from && !to;
  return (!to || s <= to) && (!from || endOf(l) >= from);
};

/** Who is off each day of a period: approved and pending, by person. */
export function perDay(leaves: Leave[], days: string[]) {
  const ix = new Map(days.map((d, i) => [d, i]));
  const rows = days.map(() => ({ approved: [] as Leave[], pending: [] as Leave[] }));
  for (const l of leaves) {
    if (l.status !== 'Approved' && l.status !== 'Pending') continue;
    for (const d of leaveDates(l)) {
      const i = ix.get(d);
      if (i === undefined) continue;
      (l.status === 'Approved' ? rows[i].approved : rows[i].pending).push(l);
    }
  }
  return rows;
}

/** A pending bar or swatch: hatched in the warning colour, so it reads as not yet decided. */
export const PENDING_FILL: CSSProperties = {
  border: '1.5px solid var(--warn)',
  boxSizing: 'border-box',
  background: 'repeating-linear-gradient(45deg, var(--warn-bg) 0 3px, var(--surface) 3px 6px)',
};
export const APPROVED_FILL = 'var(--accent)';

/** A request waiting more than this many days is called out. */
export const SLOW_DAYS = 2;

/** A pending leave as Needs action sees it: how soon it starts and how long it has waited. */
export function pendingFacts(l: Leave, today = todayISO()) {
  const toStart = daysBetween(today, startOf(l));
  const waited = l.ord ? Math.max(0, Math.floor((Date.now() - l.ord) / 86_400_000)) : 0;
  return { toStart, waited, passed: toStart < 0, soon: toStart >= 0 && toStart <= 7, slow: waited > SLOW_DAYS };
}

export function needsActionSummary(leaves: Leave[]) {
  const pending = leaves.filter((l) => l.status === 'Pending');
  const facts = pending.map((l) => pendingFacts(l));
  return {
    pending,
    passed: facts.filter((f) => f.passed).length,
    soon: facts.filter((f) => f.soon).length,
    slow: facts.filter((f) => f.slow).length,
  };
}
