/**
 * Dates and times as the notification spec writes them, and the schedule's
 * day rules. Everything here is IST, the timezone the spec's times are in.
 *
 * Human dates everywhere: "10 Oct", "10–12 Oct", "30 Sep – 2 Oct" — never an
 * ISO date in front of a person.
 */
import { holidayDatesForUser } from './holiday.service';

const IST = 'Asia/Kolkata';

/** The IST calendar parts of an instant. */
export function istParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number; weekday: string; dateKey: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(at);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? '';
  const year = Number(part('year'));
  const month = Number(part('month'));
  const day = Number(part('day'));
  return {
    year, month, day,
    // Some engines write midnight as 24.
    hour: Number(part('hour')) % 24,
    minute: Number(part('minute')),
    weekday: part('weekday'),
    dateKey: `${part('year')}-${part('month')}-${part('day')}`,
  };
}

/** A `YYYY-MM-DD` key or a Date, as the IST calendar day it falls on. */
function asDay(value: Date | string): Date {
  if (typeof value === 'string') return new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  const { dateKey } = istParts(value);
  return new Date(`${dateKey}T00:00:00.000Z`);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Spelled out rather than left to Intl: ICU versions differ ("Sept", "Mon,").

/** "10 Oct". */
export function shortDate(value: Date | string): string {
  const day = asDay(value);
  return `${day.getUTCDate()} ${MONTHS[day.getUTCMonth()]}`;
}

/** "Mon 13 Oct" — for "oldest from …". */
export function dayLabel(value: Date | string): string {
  const day = asDay(value);
  return `${WEEKDAYS[day.getUTCDay()]} ${shortDate(day)}`;
}

/** "10 Oct", "10–12 Oct", or "30 Sep – 2 Oct". */
export function dateRange(start: Date | string, end?: Date | string): string {
  const from = asDay(start);
  const to = end ? asDay(end) : from;
  if (from.getTime() === to.getTime()) return shortDate(from);
  if (from.getUTCMonth() === to.getUTCMonth() && from.getUTCFullYear() === to.getUTCFullYear()) {
    return `${from.getUTCDate()}–${shortDate(to)}`;
  }
  return `${shortDate(from)} – ${shortDate(to)}`;
}

/** "October" from a date. */
export function monthName(value: Date | string): string {
  return MONTHS_LONG[asDay(value).getUTCMonth()];
}

/** "09:30", 24-hour IST, for a shift start. */
export function clock24(at: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
}

/** "1 day", "2.5 days". */
export const days = (count: number) => `${count} ${count === 1 ? 'day' : 'days'}`;

/** `YYYY-MM-DD` of the day `offset` days from `key`. */
export function shiftDay(key: string, offset: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

const weekdayOf = (key: string) => new Date(`${key}T00:00:00.000Z`).getUTCDay();

/**
 * Whether today is this person's Tuesday/Thursday reminder day: Tuesday or
 * Thursday itself when it is a working day for them, or the next working day
 * after a Tuesday or Thursday that was a holiday at their location. Sundays
 * are never working days for this purpose.
 */
export async function tueThuDueFor(
  user: { org?: string; state?: string; location?: string; branch?: string },
  todayKey: string,
): Promise<boolean> {
  const windowStart = shiftDay(todayKey, -6);
  const holidays = await holidayDatesForUser(user, {
    from: new Date(`${windowStart}T00:00:00.000Z`),
    to: new Date(`${todayKey}T23:59:59.999Z`),
  });
  const working = (key: string) => weekdayOf(key) !== 0 && !holidays.has(key);
  if (!working(todayKey)) return false;
  const isTueThu = (key: string) => weekdayOf(key) === 2 || weekdayOf(key) === 4;
  if (isTueThu(todayKey)) return true;
  // Walk back over the days off just before today: if one of them was a
  // Tuesday or Thursday holiday, today is the first working day after it.
  for (let back = 1; back <= 6; back += 1) {
    const key = shiftDay(todayKey, -back);
    if (working(key)) return false;
    if (isTueThu(key) && holidays.has(key)) return true;
  }
  return false;
}
