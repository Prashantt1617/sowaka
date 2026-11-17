/**
 * The employee-lifecycle boards and Suwi's notices, worked out ahead of HR in the
 * engagement warm-up's round (engagement-warmup.service.ts: one company at a time,
 * a page at a time, skipped while the last round runs), so HR's first open is
 * served from memory: the manager home's roster for every company; the boards only for companies
 * with the lifecycle on; when Suwi is on, its company-wide inputs (shared by every viewer's notices
 * and its pending_requests tool) and one dashboard user's notices.
 */
import { companies, users } from '../../config/db';
import { refreshBoardData } from './board';
import { refreshOffBoardData } from './offboarding';
import { refreshWorkspaceRoster } from '../manager.service';
import { lifecycleReadCacheOn, setLifecycleRewarm } from './readCache';
import { listReaderFor, warmTimeOfficeLists } from '../timeOfficeLists';
import { settingsFor } from '../../suwi/store';
import { contextFor } from '../../suwi/tools';
import { suwiNotices } from '../../suwi/notices';
import { orgSuwiData, readerFor } from '../../suwi/orgData';
import { istToday } from '../../suwi/digest';
import { prepareRecent, recentSuwiUsers } from '../../suwi/planner';
import { logger } from '../../utils/logger';

export async function warmLifecycle(org: string, isStopping: () => boolean = () => false): Promise<Record<string, number | string>> {
  const took: Record<string, number | string> = {};
  if (!lifecycleReadCacheOn()) return took;
  const company = await companies().findOne({ id: org }, { projection: { _id: 0, features: 1 } });
  // The manager home's roster: every company (the app's manager home is not a lifecycle feature).
  const steps: [string, () => Promise<unknown>][] = [['mgr-roster', () => refreshWorkspaceRoster(org)]];
  if (company?.features?.lifecycle === true) {
    steps.push(['lc-board', () => refreshBoardData(org)]);
    steps.push(['off-board', () => refreshOffBoardData(org)]);
  }
  steps.push(['suwi-notices', async () => {
    const settings = await settingsFor(org);
    if (!settings.enabled) return;
    // The company's shared inputs first (every viewer's notices and Suwi's pending_requests read them),
    // then one viewer's notices, which are now a quick filter over them.
    const today = istToday();
    // Only with someone to read the lists as: a company with no full-access dashboard user is left to its first viewer.
    if ((await readerFor(org, '')).userId) await orgSuwiData(org, today, '', true);
    const viewer = await users().findOne(
      { org, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true }, $or: [{ dashboardAdmin: true }, { dashboardTabs: { $exists: false } }] },
    );
    if (viewer) await suwiNotices(contextFor(viewer, settings.levels, today), true);
    // "What needs my attention today?" made ahead for the people who use Suwi (planner.ts): once per
    // data version, at most once a minute each, so asking it is usually instant.
    await prepareRecent(org, today, isStopping);
  }]);
  for (const [name, run] of steps) {
    if (isStopping()) break;
    const t0 = Date.now();
    try { await run(); took[name] = Date.now() - t0; } catch (error) { took[name] = `failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200); }
  }
  return took;
}

// A company's kept answers dropped by a change are rebuilt shortly after (readCache.scheduleRewarm).
setLifecycleRewarm(async (org) => {
  await warmLifecycle(org);
  // The Time office lists the same change may have dropped (timeOfficeLists.ts).
  const who = await listReaderFor(org);
  if (who) await warmTimeOfficeLists(org, who);
});

/**
 * Right after the server starts: every company with Suwi on gets its shared inputs (from Redis when its
 * data version has a copy, so in milliseconds; else read once), its recent Suwi users' notices and their
 * prepared attention answers, before the first of them asks. Before, the first look after a deploy
 * paid the whole read (5–13 s). One company at a time; errors only logged.
 */
export async function warmSuwiAtBoot(isStopping: () => boolean = () => false): Promise<void> {
  const started = Date.now();
  const today = istToday();
  let orgs = 0;
  for (const { id: org } of await companies().find({}, { projection: { _id: 0, id: 1 } }).toArray()) {
    if (!org || isStopping()) continue;
    try {
      const settings = await settingsFor(org);
      if (!settings.enabled) continue;
      orgs++;
      // Not `fresh`: the Redis copy for this version answers at once when there is one.
      if ((await readerFor(org, '')).userId) await orgSuwiData(org, today, '');
      for (const u of await recentSuwiUsers(org)) {
        if (isStopping()) break;
        await suwiNotices(contextFor(u, settings.levels, today)).catch(() => undefined);
      }
      await prepareRecent(org, today, isStopping);
    } catch (error) {
      logger.warn('Suwi boot warm failed for a company', { org, error: (error as Error).message });
    }
  }
  logger.info('Suwi warmed at boot', { orgs, ms: Date.now() - started });
}
