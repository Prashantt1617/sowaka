/**
 * Review cycles.
 *
 * A cycle runs for one month from a configurable day — an org on day 10 has a
 * cycle running 10 Sep to 10 Oct. The cycle is keyed by the month it *starts*
 * in, so that one is `2026-09`, and every period key elsewhere in the system
 * (feedback records, KPI assignments) means the same thing.
 *
 * Day 1 reproduces plain calendar months, which is the default and what every
 * existing record was written against.
 */
import { companies } from '../config/db';

export const DEFAULT_CYCLE_START_DAY = 1;

/** Clamped to 1–28 so every month has the day. */
export function normaliseStartDay(value: unknown): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_CYCLE_START_DAY;
  return Math.min(28, Math.max(1, n));
}

/** The cycle key covering `date` for an org starting cycles on `startDay`. */
export function periodFor(date: Date, startDay: number): string {
  const day = normaliseStartDay(startDay);
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  // Before the start day, we are still inside the cycle that opened last month.
  const shifted = date.getUTCDate() >= day ? new Date(Date.UTC(y, m, 1)) : new Date(Date.UTC(y, m - 1, 1));
  return shifted.toISOString().slice(0, 7);
}

/** `2026-09` -> `2026-10`. */
export function nextPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

/** `2026-09` -> `2026-08`. */
export function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}

/** Half-open [start, end): the dates a cycle key covers. */
export function cycleWindow(period: string, startDay: number): { start: Date; end: Date } {
  const day = normaliseStartDay(startDay);
  const [y, m] = period.split('-').map(Number);
  return {
    start: new Date(Date.UTC(y, m - 1, day)),
    end: new Date(Date.UTC(y, m, day)),
  };
}

export async function cycleStartDayFor(org: string): Promise<number> {
  const company = await companies().findOne({ id: org });
  return normaliseStartDay(company?.reviewCycleStartDay ?? DEFAULT_CYCLE_START_DAY);
}

/** The cycle the org is currently inside. */
export async function currentPeriodFor(org: string, now = new Date()): Promise<string> {
  return periodFor(now, await cycleStartDayFor(org));
}

/** Everything a client needs to label and reason about the live cycle. */
export async function cycleInfoFor(org: string, now = new Date()) {
  const startDay = await cycleStartDayFor(org);
  const period = periodFor(now, startDay);
  const { start, end } = cycleWindow(period, startDay);
  return {
    period,
    next: nextPeriod(period),
    startDay,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}
