/**
 * Gives everyone who joined within the last month (and has no onboarding yet) their onboarding, where the
 * company has the lifecycle on (services/lifecycle/recentJoiners.ts).
 *   npm run lifecycle:backfill-recent-joiners            dry run: lists who would get one
 *   npm run lifecycle:backfill-recent-joiners -- --apply  makes them
 *   … -- --org=<id>                                       one company only
 */
import { closeDb, connectDb } from '../config/db';
import { backfillRecentJoiners } from '../services/lifecycle/recentJoiners';

async function main() {
  const apply = process.argv.includes('--apply');
  const org = process.argv.find((a) => a.startsWith('--org='))?.slice(6);
  await connectDb();
  const rows = await backfillRecentJoiners({ apply, ...(org ? { org } : {}) });
  for (const r of rows) console.log(`${r.org} | ${r.name} | joined ${r.tj}${r.journeyId ? ` | journey ${r.journeyId}` : apply ? ' | skipped' : ''}`);
  console.log(`${apply ? 'Started' : 'Would start'} ${rows.filter((r) => !apply || r.journeyId).length} onboarding(s).`);
  await closeDb();
}
main().catch((e) => { console.error(e); process.exit(1); });
