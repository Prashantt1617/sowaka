/**
 * Closing a leave year.
 *
 * Balances are computed on read, which is fine inside a year but no good across
 * one: an opening balance derived today from a policy edited yesterday would
 * change under people. So the boundary is a real event. This run takes every
 * employee's closing balance, applies the carry-forward and encashment HR
 * configured, and writes the result down. Next year's opening reads that row
 * rather than deriving anything.
 *
 * The run is idempotent: a year already closed for an employee is skipped, so
 * a restart or a second pass on the same day changes nothing.
 */
import { leaves, leaveYearEnds, users } from '../config/db';
import { LeaveTypeKey, LeaveTypeRule, LeaveYearEnd, processYearEnd } from '../models/shift.model';
import { logger } from '../utils/logger';
import { leaveTypeRulesFor } from './shift.service';

/** The year that closes on a given date, for a reset cadence. */
function closingYear(rule: LeaveTypeRule, now: Date): number | null {
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  if (rule.resetOn === 'calendar_year') {
    return month === 1 && day === 1 ? now.getUTCFullYear() - 1 : null;
  }
  // The Indian financial year runs April to March, so 1 April closes the year
  // that began the previous April — keyed by the year it started in.
  return month === 4 && day === 1 ? now.getUTCFullYear() - 1 : null;
}

/** The window a leave year covers, as UTC dates. */
function yearWindow(rule: LeaveTypeRule, year: number): { start: Date; end: Date } {
  return rule.resetOn === 'calendar_year'
    ? { start: new Date(Date.UTC(year, 0, 1)), end: new Date(Date.UTC(year, 11, 31)) }
    : { start: new Date(Date.UTC(year, 3, 1)), end: new Date(Date.UTC(year + 1, 2, 31)) };
}

/** Days of a type approved inside a window. */
async function usedIn(userId: string, type: LeaveTypeKey, start: Date, end: Date): Promise<number> {
  const rows = await leaves()
    .find({ userId, type, status: 'approved', startDate: { $lte: end }, endDate: { $gte: start } })
    .toArray();
  return rows.reduce((total, leave) => total + (leave.days ?? 0), 0);
}

/** What last year's run carried into this one, or null if it never ran. */
export async function carriedFromRun(
  userId: string,
  type: LeaveTypeKey,
  year: number,
): Promise<number | null> {
  const row = await leaveYearEnds().findOne({ userId, type, year: year - 1 });
  return row ? row.carried : null;
}

export interface YearEndResult {
  processed: number;
  skipped: number;
  rows: LeaveYearEnd[];
}

/**
 * Closes `year` for one employee, for every leave type whose cadence ends then.
 * `types` may be passed in when the caller already has them.
 */
export async function closeYearForUser(
  userId: string,
  year: number,
  now = new Date(),
  force = false,
): Promise<YearEndResult> {
  const user = await users().findOne({ userId });
  if (!user?.org) return { processed: 0, skipped: 0, rows: [] };
  const rules = await leaveTypeRulesFor(userId);
  const rows: LeaveYearEnd[] = [];
  let skipped = 0;

  for (const rule of rules) {
    // Only the types whose year actually ends today, unless forced.
    if (!force && closingYear(rule, now) !== year) { skipped += 1; continue; }
    const already = await leaveYearEnds().findOne({ userId, year, type: rule.key });
    if (already) { skipped += 1; continue; }

    const { start, end } = yearWindow(rule, year);
    const accrued = rule.key === 'comp_off'
      ? await compOffEarned(userId, start, end)
      : rule.perMonth * 12;
    const opening = (await carriedFromRun(userId, rule.key, year)) ?? 0;
    const closing = accrued + opening - (await usedIn(userId, rule.key, start, end));
    const split = processYearEnd(closing, rule);
    const row: LeaveYearEnd = {
      org: user.org,
      userId,
      year,
      type: rule.key,
      closing: round(closing),
      carried: round(split.carried),
      encashed: round(split.encashed),
      lapsed: round(split.lapsed),
      processedAt: new Date(),
    };
    await leaveYearEnds().insertOne(row);
    rows.push(row);
  }
  return { processed: rows.length, skipped, rows };
}

/** Comp-off earned by approved overtime in a window — the accrual for that type. */
async function compOffEarned(userId: string, start: Date, end: Date): Promise<number> {
  const { overtimeRequests } = await import('../config/db');
  const { COMP_OFF_CREDIT } = await import('../models/shift.model');
  const { fullDayHoursFor } = await import('./shift.service');
  const [approved, fullDay] = await Promise.all([
    overtimeRequests().find({ userId, status: 'approved', workDate: { $gte: start, $lte: end } }).toArray(),
    fullDayHoursFor(userId),
  ]);
  return round(approved.reduce(
    (total, request) => total + COMP_OFF_CREDIT[request.hours >= fullDay ? 'full_day' : 'half_day'],
    0,
  ));
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The daily pass. Every employee whose leave year ends today gets closed; on
 * every other day this does nothing and costs one query.
 */
export async function runLeaveYearEnd(now = new Date()): Promise<YearEndResult> {
  const roster = await users().find({ lifecycleStatus: { $ne: 'terminated' } })
    .project<{ userId: string }>({ userId: 1 }).toArray();
  let processed = 0; let skipped = 0; const rows: LeaveYearEnd[] = [];
  for (const person of roster) {
    // Which year closes depends on the employee's own cadence, so ask per type.
    for (const year of [now.getUTCFullYear() - 1]) {
      const result = await closeYearForUser(person.userId, year, now);
      processed += result.processed; skipped += result.skipped; rows.push(...result.rows);
    }
  }
  if (processed > 0) {
    logger.info('Leave year-end processed', {
      processed,
      encashed: round(rows.reduce((t, r) => t + r.encashed, 0)),
      lapsed: round(rows.reduce((t, r) => t + r.lapsed, 0)),
    });
  }
  return { processed, skipped, rows };
}
