/**
 * One-off: the dashboard's Connect section (engagementposts, relaygame,
 * contentreports) became Engagement (appusage, feed, engagementplan, contests,
 * games). Anyone given any Connect tab is given all five; the old keys go.
 * Run once after deploying: `node --env-file=.env --import tsx src/scripts/engagement-tabs-migrate.ts [--dry]`.
 */
import { connectDb, users } from '../config/db';

const OLD = ['engagementposts', 'relaygame', 'contentreports'];
const NEW = ['appusage', 'feed', 'engagementplan', 'contests', 'games'];

(async () => {
  const dry = process.argv.includes('--dry');
  await connectDb();
  const rows = await users().find({ dashboardTabs: { $in: OLD } }, { projection: { _id: 0, userId: 1, org: 1, name: 1, dashboardTabs: 1 } }).toArray();
  for (const row of rows) {
    const kept = (row.dashboardTabs ?? []).filter((t) => !OLD.includes(t) && !NEW.includes(t));
    const next = [...kept, ...NEW];
    console.log(`${row.org} · ${row.name}: ${(row.dashboardTabs ?? []).join(',')} -> ${next.join(',')}`);
    if (!dry) await users().updateOne({ userId: row.userId }, { $set: { dashboardTabs: next } });
  }
  console.log(`${dry ? 'Would move' : 'Moved'} ${rows.length} people.`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
