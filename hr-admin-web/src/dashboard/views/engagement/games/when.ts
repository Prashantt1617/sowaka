// Plays in India time: days, hours, weeks and months, and who played when.
// A play is [game index, person index, seconds since 1970] (see services/engagement-games).

export type Play = [number, number, number];

const IST = 330 * 60;
const DAY = 86_400;
export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-11", the India day a moment falls on. */
export const dayOf = (sec: number) => new Date((sec + IST) * 1000).toISOString().slice(0, 10);
export const hourOf = (sec: number) => new Date((sec + IST) * 1000).getUTCHours();
/** 0 is Monday. */
export const weekdayOf = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
export const today = () => dayOf(Math.floor(Date.now() / 1000));
export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY * 1000).toISOString().slice(0, 10);
export const mondayOf = (day: string) => addDays(day, -weekdayOf(day));
export const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
/** The first instant of an India day, in seconds. */
export const startOf = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000 - IST;

/** "11 Nov", "11 Nov 2025" when not this year. */
export function shortDate(day: string, withYear = false) {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MON[m - 1]}${withYear ? ` ${y}` : ''}`;
}
export const monthName = (month: string) => MON[Number(month.slice(5, 7)) - 1];
/** "11 Nov, 4:05 pm" in India time. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const s = Math.floor(t / 1000);
  const d = dayOf(s);
  const h = hourOf(s);
  const min = new Date((s + IST) * 1000).getUTCMinutes();
  return `${shortDate(d, d.slice(0, 4) !== today().slice(0, 4))}, ${h % 12 || 12}:${String(min).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
/** "12 Oct – 11 Nov". */
export const rangeLabel = (from: string, to: string) => `${shortDate(from)} – ${shortDate(to)}`;
export const hourLabel = (h: number) => `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`;

export interface Bar {
  key: string;
  label: string;
  value: number;
  title: string;
  weekend?: boolean;
  current?: boolean;
}

/** People playing, counted once per bucket (an hour of a day, a day, a week, a month). */
function distinctBy(plays: Play[], bucket: (p: Play) => string | null): Map<string, number> {
  const sets = new Map<string, Set<number>>();
  for (const p of plays) {
    const k = bucket(p);
    if (k === null) continue;
    let s = sets.get(k);
    if (!s) sets.set(k, (s = new Set()));
    s.add(p[1]);
  }
  return new Map([...sets].map(([k, s]) => [k, s.size]));
}

const inRange = (p: Play, from: string, to: string) => {
  const d = dayOf(p[2]);
  return d >= from && d <= to;
};

/** People playing in each hour, added up across the days of the range. */
export function byHour(plays: Play[], from: string, to: string): Bar[] {
  const per = distinctBy(plays, (p) => (inRange(p, from, to) ? `${dayOf(p[2])}|${hourOf(p[2])}` : null));
  const hours = new Array(24).fill(0);
  for (const [k, n] of per) hours[Number(k.split('|')[1])] += n;
  // Office hours always, and any other hour someone played in.
  const used = hours.map((n, h) => (n > 0 ? h : -1)).filter((h) => h >= 0);
  const lo = Math.min(7, ...used);
  const hi = Math.max(22, ...used);
  const out: Bar[] = [];
  for (let h = lo; h <= hi; h += 1) out.push({ key: String(h), label: hourLabel(h), value: hours[h], title: `${hours[h]} around ${hourLabel(h).replace('a', ' am').replace('p', ' pm')}` });
  return out;
}

export function byDay(plays: Play[], from: string, to: string): Bar[] {
  const per = distinctBy(plays, (p) => (inRange(p, from, to) ? dayOf(p[2]) : null));
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push(d);
  const thin = days.length > 16;
  const every = Math.ceil(days.length / 14);
  return days.map((d, i) => {
    const wd = weekdayOf(d);
    const label = !thin ? `${DOW[wd]} ${Number(d.slice(8))}` : i % every === 0 ? shortDate(d) : '';
    return { key: d, label, value: per.get(d) ?? 0, title: `${per.get(d) ?? 0} on ${DOW[wd]} ${shortDate(d)}`, weekend: wd >= 5 };
  });
}

export function byWeek(plays: Play[], from: string, to: string): Bar[] {
  const per = distinctBy(plays, (p) => (inRange(p, from, to) ? mondayOf(dayOf(p[2])) : null));
  const weeks: string[] = [];
  for (let w = mondayOf(from); w <= to && weeks.length < 120; w = addDays(w, 7)) weeks.push(w);
  const every = Math.ceil(weeks.length / 14);
  return weeks.map((w, i) => {
    const shown = w < from ? from : w;
    return { key: w, label: i % every === 0 ? shortDate(shown) : '', value: per.get(w) ?? 0, title: `${per.get(w) ?? 0}, week of ${shortDate(w)}` };
  });
}

/** The last twelve months, this one so far. */
export function byMonth(plays: Play[]): Bar[] {
  const now = today().slice(0, 7);
  const per = distinctBy(plays, (p) => dayOf(p[2]).slice(0, 7));
  const out: Bar[] = [];
  for (let k = 11; k >= 0; k -= 1) {
    const m = addMonths(now, -k);
    const label = `${monthName(m)}${m.endsWith('-01') || k === 11 ? ` ${m.slice(2, 4)}` : ''}`;
    out.push({ key: m, label, value: per.get(m) ?? 0, title: `${per.get(m) ?? 0} in ${monthName(m)} ${m.slice(0, 4)}`, current: m === now });
  }
  return out;
}

/** "Busiest on Thursdays, 4–5 pm", from every play. */
export function busiest(plays: Play[]): string {
  if (!plays.length) return 'Nobody has played yet';
  const hours = new Array(24).fill(0);
  const days = new Array(7).fill(0);
  for (const p of plays) {
    hours[hourOf(p[2])] += 1;
    days[weekdayOf(dayOf(p[2]))] += 1;
  }
  const h = hours.indexOf(Math.max(...hours));
  const d = days.indexOf(Math.max(...days));
  return `Busiest on ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][d]}s, ${h % 12 || 12}–${(h + 1) % 12 || 12} ${h + 1 < 12 || h + 1 === 24 ? 'am' : 'pm'}`;
}
