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
  const waited = daysSince(l.ord);
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

export type PeriodId = 'last' | 'week' | 'month' | 'next' | 'all' | 'custom';

/** The bounds of a period, and its heading. Empty bounds are open. */
export function periodRange(id: PeriodId, customFrom: string, customTo: string): { from: string; to: string; title: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const month = (k: number) => {
    const first = new Date(y, m + k, 1);
    return { from: isoOf(first), to: isoOf(new Date(first.getFullYear(), first.getMonth() + 1, 0)), title: `${MONTH[first.getMonth()]} ${first.getFullYear()}` };
  };
  if (id === 'last') return month(-1);
  if (id === 'next') return month(1);
  if (id === 'month') return month(0);
  if (id === 'week') {
    const back = (now.getDay() + 6) % 7; // Monday starts the week
    const from = addDays(todayISO(), -back);
    const to = addDays(from, 6);
    const f = dateOf(from), t = dateOf(to);
    const span = f.getMonth() === t.getMonth() ? `${f.getDate()}–${t.getDate()} ${MON[t.getMonth()]}` : `${f.getDate()} ${MON[f.getMonth()]} – ${t.getDate()} ${MON[t.getMonth()]}`;
    return { from, to, title: `This week · ${span}` };
  }
  if (id === 'custom') {
    if (!customFrom) return { from: '', to: '', title: 'Custom range' };
    return { from: customFrom, to: customTo, title: customFrom === customTo ? dayLabel(customFrom) : `${dayLabel(customFrom)} – ${dayLabel(customTo)}` };
  }
  return { from: '', to: '', title: 'All dates' };
}

/** The days a period's chart draws: none for All dates or anything over two months. */
export const chartDaysOf = (r: { from: string; to: string }) =>
  r.from && r.to && r.from <= r.to && daysBetween(r.from, r.to) <= 62 ? daysIn(r.from, r.to) : [];

/** Whole days since a timestamp (ms). */
export const daysSince = (ms: number) => (ms ? Math.max(0, Math.floor((Date.now() - ms) / 86_400_000)) : 0);

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Checks a custom range before it is applied; the message, or '' when fine. */
export const rangeProblem = (from: string, to: string) =>
  !from || !to ? 'Pick both a start and an end date.' : to < from ? 'The end date is before the start date.' : '';

/** The leave tables' columns: employee, type, dates, days, reason, manager, status, applied. */
export const LEAVE_COLS = '1.7fr 1fr 1.3fr .6fr 1.7fr 1.3fr 1.1fr .8fr';

/** perDay's leaves as head counts: each person once a day, approved and pending. */
export const peopleTotals = (rows: { approved: Leave[]; pending: Leave[] }[]) => {
  const n = (ls: Leave[]) => new Set(ls.map((l) => l.submitterId || l.name)).size;
  return rows.map((r) => ({ a: n(r.approved), p: n(r.pending) }));
};
