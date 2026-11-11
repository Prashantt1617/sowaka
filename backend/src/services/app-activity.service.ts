/**
 * A light record of who used the app, and when, for the dashboard's App usage
 * page. The app is not changed: the server notes the requests it already
 * makes. One row per person per day (IST):
 *
 *   - `hours`: the IST hours they used the app in, so "opened the app" and
 *     "when people open it" can be counted;
 *   - `did`: screens whose request only goes out when the person opens them
 *     (payslips, payroll's salary & tax, the tax declaration).
 *
 * Only requests from the app count (its HTTP client says `Dart/…`); the HR
 * dashboard's and the games' web pages do not. Each person, hour and screen is
 * written at most once a day per server process: after that a request costs a
 * lookup in memory and nothing else. Nothing here can fail a request.
 */
import type { Request } from 'express';
import type { Collection } from 'mongodb';
import { getDb } from '../config/db';
import { logger } from '../utils/logger';

export type AppActivityScreen = 'payslips' | 'payroll' | 'taxdeclaration';

export interface AppActivityDay {
  org: string;
  userId: string;
  /** YYYY-MM-DD, IST. */
  day: string;
  /** IST hours (0–23) with at least one request from the app. */
  hours: number[];
  did: AppActivityScreen[];
  firstAt: Date;
}

/** Requests that only go out when the person opens that screen. */
const SCREENS: { method: string; path: RegExp; screen: AppActivityScreen }[] = [
  { method: 'GET', path: /^\/payslips\/mine$/, screen: 'payslips' },
  { method: 'GET', path: /^\/payroll\/home$/, screen: 'payroll' },
  { method: 'GET', path: /^\/payroll\/tax-declaration$/, screen: 'taxdeclaration' },
];

let indexed: Promise<unknown> | null = null;
export function appActivity(): Collection<AppActivityDay> {
  const col = getDb().collection<AppActivityDay>('appActivity');
  if (!indexed) {
    indexed = Promise.all([
      col.createIndex({ userId: 1, day: 1 }, { unique: true }),
      col.createIndex({ org: 1, day: 1 }),
    ]).catch((error) => {
      indexed = null;
      logger.warn('appActivity indexes not created', { error: String(error) });
    });
  }
  return col;
}

const IST_OFFSET_MS = 330 * 60_000;
function istParts(now: Date): { day: string; hour: number } {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  return { day: ist.toISOString().slice(0, 10), hour: ist.getUTCHours() };
}

/** What this process has already written today: `userId|day|h12`, `userId|day|payslips`. */
const written = new Set<string>();
let writtenDay = '';

/** Whether a request came from the Sowaka app rather than a browser. */
export function fromApp(req: Pick<Request, 'header'>): boolean {
  return /^Dart\//.test(req.header('user-agent') ?? '');
}

/** Note this request against its person, if it came from the app. Fire and forget. */
export function noteAppRequest(req: Request, user: { userId: string; org?: string }): void {
  try {
    if (!user.org || !fromApp(req)) return;
    const now = new Date();
    const { day, hour } = istParts(now);
    if (day !== writtenDay) {
      written.clear();
      writtenDay = day;
    }
    const path = (req.originalUrl || req.url).split('?')[0].replace(/^\/api(?=\/)/, '');
    const screen = SCREENS.find((s) => s.method === req.method && s.path.test(path))?.screen;
    const hourKey = `${user.userId}|${day}|h${hour}`;
    const screenKey = screen ? `${user.userId}|${day}|${screen}` : '';
    const newHour = !written.has(hourKey);
    const newScreen = Boolean(screenKey) && !written.has(screenKey);
    if (!newHour && !newScreen) return;
    written.add(hourKey);
    if (screenKey) written.add(screenKey);
    const add: Record<string, unknown> = { hours: hour };
    if (newScreen) add.did = screen;
    void appActivity()
      .updateOne(
        { userId: user.userId, day },
        { $addToSet: add, $setOnInsert: { org: user.org, firstAt: now } },
        { upsert: true },
      )
      .catch((error) => {
        // Let the next request try again.
        written.delete(hourKey);
        if (screenKey) written.delete(screenKey);
        logger.warn('appActivity not written', { error: String(error) });
      });
  } catch {
    // Never in a request's way.
  }
}
