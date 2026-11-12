/**
 * Dashboard › Engagement, worked out ahead of HR.
 *
 * Every four minutes, for each company with someone on the dashboard, the
 * views the Engagement pages open with are worked out again and kept in the
 * engagement cache (five minutes), so HR's first open is served from memory
 * instead of seconds of queries:
 *   - App usage: the summary, "when" and the trend by date, for the last 30
 *     days ending today (IST), no department or location chosen: the page's
 *     own defaults (AppUsage.tsx, usage/trend.tsx), asked with the same
 *     arguments the dashboard sends, so the cache key is the same;
 *   - Games, Contests and the Engagement plan, which take no arguments.
 *
 * One company at a time, a page at a time, a pause between companies, and a
 * round is skipped while the last one is still going, so the warm-up never
 * adds more than one page's queries to the cluster at once. Companies are
 * those with an active dashboard user who is not a hidden support account,
 * leaving out ENGAGEMENT_WARM_SKIP_ORGS (test and demo companies).
 */
import { users } from '../config/db';
import { logger } from '../utils/logger';
import { refreshEngagement } from './engagement-cache';
import { listContests } from './engagement-contests.service';
import { gamesOverview } from './engagement-games.service';
import { planFor } from './engagement-plan.service';
import { usageSummary, usageTrend, usageWhen } from './engagement-usage.service';

const ROUND_MS = 4 * 60_000;
/** After the server starts, so boot is not slowed by it. */
const FIRST_ROUND_MS = 30_000;
/** Between one company and the next. */
const BETWEEN_ORGS_MS = 2_000;
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Test and demo companies nobody needs warmed; `ENGAGEMENT_WARM_SKIP_ORGS` (comma-separated) replaces the list. */
const DEFAULT_SKIP = ['sowaka', 'halcyon', 'toyota'];
const skipOrgs = (): Set<string> => {
  const raw = process.env.ENGAGEMENT_WARM_SKIP_ORGS;
  const list = raw === undefined ? DEFAULT_SKIP : raw.split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(list);
};

let timer: NodeJS.Timeout | undefined;
let running: Promise<void> | null = null;
let stopped = true;
/** Set by `stopEngagementWarmup`: a round under way stops after the page it is on. */
let stopping = false;

const istToday = () => new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const pause = (ms: number) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  t.unref();
});

/** Companies with an active dashboard user who is not a hidden support account. */
export async function orgsToWarm(): Promise<string[]> {
  const orgs = await users().distinct('org', {
    dashboardAccess: true,
    lifecycleStatus: { $nin: ['offboarded', 'terminated'] },
    hiddenFromDirectory: { $ne: true },
  });
  const skip = skipOrgs();
  return (orgs as unknown[])
    .filter((o): o is string => typeof o === 'string' && o.length > 0 && !skip.has(o) && !/scratch|test/i.test(o))
    .sort();
}

/**
 * One company's default views, one after another, each through the page's own
 * function with the dashboard's own arguments. Returns how long each took.
 */
export async function warmOrg(org: string): Promise<Record<string, number | string>> {
  const to = istToday();
  const from = addDays(to, -29);
  const steps: [string, () => Promise<unknown>][] = [
    // `userId` is not part of the summary's key; the dashboard's own caller has one.
    ['summary', () => usageSummary({ userId: '', org }, { from, to })],
    // URLSearchParams sends these exactly so: dept=All&loc=All, gran=date.
    ['when', () => usageWhen(org, { from, to, dept: 'All', loc: 'All' })],
    ['trend', () => usageTrend(org, { gran: 'date', from, to, dept: 'All', loc: 'All' })],
    ['games', () => gamesOverview(org)],
    ['contests', () => listContests(org)],
    ['plan', () => planFor(org)],
  ];
  const took: Record<string, number | string> = {};
  for (const [name, ask] of steps) {
    if (stopping) break;
    const t0 = Date.now();
    try {
      await refreshEngagement(ask);
      took[name] = Date.now() - t0;
    } catch (error) {
      took[name] = `failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
    }
  }
  return took;
}

async function round(): Promise<void> {
  const t0 = Date.now();
  const orgs = await orgsToWarm();
  const perOrg: Record<string, Record<string, number | string>> = {};
  for (const [i, org] of orgs.entries()) {
    if (stopping) break;
    if (i > 0) await pause(BETWEEN_ORGS_MS);
    perOrg[org] = await warmOrg(org);
  }
  logger.info('Engagement warm-up', { orgs: orgs.length, ms: Date.now() - t0, perOrg });
}

function schedule(ms: number): void {
  timer = setTimeout(() => {
    if (stopped) return;
    if (running) {
      // The last round is still going (a slow cluster): skip this one.
      logger.info('Engagement warm-up skipped: the last round is still running');
    } else {
      running = round()
        .catch((error) => logger.error('Engagement warm-up failed', {}, error))
        .finally(() => {
          running = null;
        });
    }
    schedule(ROUND_MS);
  }, ms);
  timer.unref();
}

export function startEngagementWarmup(): void {
  if (!stopped) return;
  stopped = false;
  stopping = false;
  schedule(FIRST_ROUND_MS);
  logger.info('Engagement warm-up started', { everyMinutes: ROUND_MS / 60_000 });
}

/** Stops the timer; a round under way stops after the page it is on. Resolves once it has. */
export async function stopEngagementWarmup(): Promise<void> {
  stopped = true;
  stopping = true;
  if (timer) clearTimeout(timer);
  timer = undefined;
  await running;
}
