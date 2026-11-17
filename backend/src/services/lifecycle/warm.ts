/**
 * The employee-lifecycle boards and Suwi's notices, worked out ahead of HR in the
 * engagement warm-up's round (engagement-warmup.service.ts: one company at a time,
 * a page at a time, skipped while the last round runs), so HR's first open is
 * served from memory: the manager home's roster for every company; the boards only for companies
 * with the lifecycle on; Suwi's notices for
 * the one dashboard user the Time office warm-up also uses, when Suwi is on.
 */
import { companies, users } from '../../config/db';
import { refreshBoardData } from './board';
import { refreshOffBoardData } from './offboarding';
import { refreshWorkspaceRoster } from '../manager.service';
import { lifecycleReadCacheOn } from './readCache';
import { settingsFor } from '../../suwi/store';
import { contextFor } from '../../suwi/tools';
import { suwiNotices } from '../../suwi/notices';
import { istToday } from '../../suwi/digest';

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
    const viewer = await users().findOne(
      { org, dashboardAccess: true, lifecycleStatus: { $nin: ['offboarded', 'terminated'] }, hiddenFromDirectory: { $ne: true }, $or: [{ dashboardAdmin: true }, { dashboardTabs: { $exists: false } }] },
    );
    if (viewer) await suwiNotices(contextFor(viewer, settings.levels, istToday()), true);
  }]);
  for (const [name, run] of steps) {
    if (isStopping()) break;
    const t0 = Date.now();
    try { await run(); took[name] = Date.now() - t0; } catch (error) { took[name] = `failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 200); }
  }
  return took;
}
