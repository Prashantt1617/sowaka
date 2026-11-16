/**
 * Due rules: every lifecycle date is a rule on an anchor (Tj, Tl, an event, a
 * probation month), resolved per journey. See docs/lifecycle/CONTRACT.md
 * decision 4 and the handover's "Due-date engine".
 *
 * Dates are calendar days in the company's time zone. A resolved date is
 * stored as UTC midnight of that day (the convention holidays use), so
 * `toISOString().slice(0, 10)` is always the local day it means.
 *
 * Working days skip the company's week-offs and public holidays: the
 * employee's own grid when there is an employee, else the company's default
 * shift template, else the saved shift policy, else Saturday and Sunday.
 */
import { holidays, shiftPolicies, shiftTemplates } from '../../config/db';
import type { DueRule } from '../../models/lifecycle.model';
import { holidayAppliesTo } from '../holiday.service';
import { isWeekOffDay, weekOffGridFor } from '../shift.service';

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** The company's time zone. No company sets one yet; every office is in India. */
export function companyTimeZone(_org?: string): string {
  return DEFAULT_TIME_ZONE;
}

// ─── Calendar days ───────────────────────────────────────────────────────────

const KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !KEY.test(value)) return false;
  const at = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(at.getTime()) && at.toISOString().slice(0, 10) === value;
}

/** The local calendar day an instant falls on. */
export function dateKeyOf(at: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** The local hour (0–23) of an instant. */
export function localHour(at: Date, timeZone = DEFAULT_TIME_ZONE): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(at);
  return Number(hour) % 24;
}

/** A day key as the stored Date (UTC midnight). */
export function dayDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** A stored day (UTC midnight) back to its key. */
export function keyOfDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export function addDaysKey(key: string, days: number): string {
  const at = dayDate(key);
  at.setUTCDate(at.getUTCDate() + days);
  return keyOfDay(at);
}

/** Calendar months, clamped to the month's last day (31 Jan + 1 month → 28/29 Feb). */
export function addMonthsKey(key: string, months: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return keyOfDay(target);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayDate(b).getTime() - dayDate(a).getTime()) / 86_400_000);
}

export function todayKey(now = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  return dateKeyOf(now, timeZone);
}

// ─── Probation months ───────────────────────────────────────────────────────

/** First day of probation month n (1-based): Tj + (n − 1) calendar months. */
export function probationMonthStart(tj: string, n: number): string {
  return addMonthsKey(tj, n - 1);
}

/** Last day of probation month n: the day before month n + 1 starts. */
export function probationMonthEnd(tj: string, n: number): string {
  return addDaysKey(addMonthsKey(tj, n), -1);
}

/** The probation month a day falls in (0 before Tj; `total` once probation is over). */
export function probationMonthOn(tj: string, day: string, total: number): number {
  if (day < tj) return 0;
  for (let n = 1; n <= total; n += 1) if (day <= probationMonthEnd(tj, n)) return n;
  return total;
}

/** The months a month rule covers, or null when the rule is not a month rule. */
export function monthsOfRule(rule: DueRule | null | undefined, total: number): number[] | null {
  if (!rule || (rule.anchor !== 'month_start' && rule.anchor !== 'month_end')) return null;
  const month = rule.month ?? 'each';
  if (month === 'each') return Array.from({ length: total }, (_, i) => i + 1);
  if (month === 'last') return [total];
  const list = Array.isArray(month) ? month : [month];
  return [...new Set(list.filter((n) => Number.isInteger(n) && n >= 1 && n <= total))].sort((a, b) => a - b);
}

// ─── Working days ───────────────────────────────────────────────────────────

export interface WorkCalendar {
  /** Week of the month (1–5) → weekday indexes off, 0 = Mon … 6 = Sun. */
  weeklyOff: Record<string, number[]>;
  /** Public holidays, as day keys. */
  holidays: Set<string>;
}

const SAT_SUN: Record<string, number[]> = { '1': [5, 6], '2': [5, 6], '3': [5, 6], '4': [5, 6], '5': [5, 6] };

/**
 * The company's working calendar. With an employee, their own week-off grid
 * and the holidays of their location; without one (a candidate), the
 * company's default shift and the holidays for the given location.
 */
export async function workCalendar(org: string, opts: { userId?: string; location?: string } = {}): Promise<WorkCalendar> {
  let weeklyOff: Record<string, number[]> | undefined;
  // The employee's own grid, once the company has set week-offs up (a shift template or a saved policy).
  // Before that the shift service answers with its built-in default (Sunday only), which is not the
  // company's: the fallback below (Saturday and Sunday) is, as it is for a candidate.
  const setUp = !!opts.userId && (
    (await shiftTemplates().countDocuments({ org, active: true, deletedAt: { $exists: false } }, { limit: 1 })) > 0
    || (await shiftPolicies().countDocuments({ org, weeklyOff: { $exists: true } }, { limit: 1 })) > 0);
  if (opts.userId && setUp) {
    try { weeklyOff = await weekOffGridFor(opts.userId); } catch { weeklyOff = undefined; }
  }
  if (!weeklyOff) {
    const template = await shiftTemplates().findOne(
      { org, active: true, isDefault: true, deletedAt: { $exists: false } },
      { projection: { _id: 0, 'policy.weeklyOff': 1 } },
    );
    weeklyOff = template?.policy?.weeklyOff;
  }
  if (!weeklyOff) {
    const saved = await shiftPolicies().findOne({ org }, { projection: { _id: 0, weeklyOff: 1 } });
    weeklyOff = saved?.weeklyOff;
  }
  const rows = await holidays().find({ org }, { projection: { _id: 0, date: 1, state: 1, type: 1 } }).toArray();
  const where = { location: opts.location };
  const days = new Set(
    rows
      .filter((row) => (row.type ?? 'Public') === 'Public')
      .filter((row) => holidayAppliesTo(row, where))
      .map((row) => keyOfDay(row.date)),
  );
  return { weeklyOff: weeklyOff && Object.keys(weeklyOff).length ? weeklyOff : SAT_SUN, holidays: days };
}

export function isWorkingDay(key: string, calendar: WorkCalendar): boolean {
  if (calendar.holidays.has(key)) return false;
  return !isWeekOffDay(dayDate(key), calendar.weeklyOff);
}

/** n working days after (or, negative, before) a day. 0 is the day itself. */
export function addWorkingDaysKey(key: string, n: number, calendar: WorkCalendar): string {
  if (!n) return key;
  const step = n > 0 ? 1 : -1;
  let left = Math.abs(n);
  let day = key;
  // A calendar with every day off would never end; a year is far past any rule.
  for (let guard = 0; left > 0 && guard < 400; guard += 1) {
    day = addDaysKey(day, step);
    if (isWorkingDay(day, calendar)) left -= 1;
  }
  return day;
}

/** `addWorkingDays(org, date, n)` from the contract: n working days from a day, as the stored Date. */
export async function addWorkingDays(
  org: string, date: Date | string, n: number, opts: { userId?: string; location?: string; calendar?: WorkCalendar } = {},
): Promise<Date> {
  const calendar = opts.calendar ?? (await workCalendar(org, opts));
  const key = typeof date === 'string' ? date.slice(0, 10) : dateKeyOf(date, companyTimeZone(org));
  return dayDate(addWorkingDaysKey(key, n, calendar));
}

// ─── Rules ──────────────────────────────────────────────────────────────────

export interface RuleAnchors {
  tj?: string;
  tl?: string;
  offer_sent?: Date;
  accepted?: Date;
  finalised?: Date;
  exit_accepted?: Date;
}

export interface RuleContext {
  org: string;
  /** Preloaded calendar; loaded on demand for working-day rules when absent. */
  calendar?: WorkCalendar;
  userId?: string;
  location?: string;
  /** Probation length including any extension. */
  probationMonths?: number;
  /** The probation month a month task belongs to. */
  month?: number;
  timeZone?: string;
}

export function isValidRule(rule: unknown): rule is DueRule {
  if (!rule || typeof rule !== 'object') return false;
  const r = rule as Record<string, unknown>;
  const anchors = ['offer_sent', 'accepted', 'finalised', 'tj', 'month_start', 'month_end', 'tl', 'exit_accepted'];
  if (!anchors.includes(String(r.anchor))) return false;
  if (r.offset !== undefined && (!Number.isInteger(r.offset) || Math.abs(Number(r.offset)) > 400)) return false;
  if (r.unit !== undefined && r.unit !== 'days' && r.unit !== 'working_days') return false;
  if (r.month !== undefined) {
    const m = r.month;
    const okMonth = (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 24;
    if (!(m === 'each' || m === 'last' || okMonth(m) || (Array.isArray(m) && m.length > 0 && m.every(okMonth)))) return false;
  }
  return true;
}

/** The anchor's day, or null when it is not known yet. */
function anchorDay(rule: DueRule, anchors: RuleAnchors, ctx: RuleContext): string | null {
  const tz = ctx.timeZone ?? companyTimeZone(ctx.org);
  switch (rule.anchor) {
    case 'tj': return anchors.tj ?? null;
    case 'tl': return anchors.tl ?? null;
    case 'offer_sent':
    case 'accepted':
    case 'finalised':
    case 'exit_accepted': {
      const at = anchors[rule.anchor];
      return at ? dateKeyOf(at, tz) : null;
    }
    case 'month_start':
    case 'month_end': {
      if (!anchors.tj) return null;
      const total = ctx.probationMonths ?? 6;
      const month = ctx.month ?? (typeof rule.month === 'number' ? rule.month : rule.month === 'last' ? total : Array.isArray(rule.month) ? rule.month[0] : 1);
      return rule.anchor === 'month_start' ? probationMonthStart(anchors.tj, month) : probationMonthEnd(anchors.tj, month);
    }
    default: return null;
  }
}

/** A rule resolved against a calendar already in hand. */
export function resolveRuleWith(rule: DueRule | null | undefined, anchors: RuleAnchors, ctx: RuleContext & { calendar: WorkCalendar }): Date | null {
  if (!rule) return null;
  const base = anchorDay(rule, anchors, ctx);
  if (!base) return null;
  const offset = rule.offset ?? 0;
  const day = rule.unit === 'working_days' ? addWorkingDaysKey(base, offset, ctx.calendar) : addDaysKey(base, offset);
  return dayDate(day);
}

/** `resolveRule(rule, anchors, ctx)` from the contract. */
export async function resolveRule(rule: DueRule | null | undefined, anchors: RuleAnchors, ctx: RuleContext): Promise<Date | null> {
  if (!rule) return null;
  const calendar = ctx.calendar ?? (rule.unit === 'working_days' ? await workCalendar(ctx.org, ctx) : { weeklyOff: SAT_SUN, holidays: new Set<string>() });
  return resolveRuleWith(rule, anchors, { ...ctx, calendar });
}

const MINUS = '−';

/** The rule as the template editor writes it: "Tj − 5", "Tl + 2 working days", "End of each month". */
export function describeRule(rule: DueRule | null | undefined): string {
  if (!rule) return '—';
  const offset = rule.offset ?? 0;
  const unit = rule.unit === 'working_days' ? ` working day${Math.abs(offset) === 1 ? '' : 's'}` : '';
  const shift = offset ? ` ${offset > 0 ? '+' : MINUS} ${Math.abs(offset)}${unit}` : '';
  const names: Record<string, string> = {
    tj: 'Tj', tl: 'Tl', offer_sent: 'Offer sent', accepted: 'Accepted', finalised: 'Finalised', exit_accepted: 'Accepted',
  };
  if (rule.anchor === 'month_start' || rule.anchor === 'month_end') {
    const edge = rule.anchor === 'month_start' ? 'Start' : 'End';
    const m = rule.month ?? 'each';
    const which = m === 'each' ? 'each month' : m === 'last' ? 'the last month' : `month ${Array.isArray(m) ? m.join(' and ') : m}`;
    return `${edge} of ${which}${shift}`;
  }
  return `${names[rule.anchor] ?? rule.anchor}${shift}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Fri 5 Dec". */
export function humanDay(key: string): string {
  const at = dayDate(key);
  return `${WEEKDAYS[at.getUTCDay()]} ${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}
