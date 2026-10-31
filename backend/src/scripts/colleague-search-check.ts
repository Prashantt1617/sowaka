/**
 * Scratch-database check of the colleague search the games' invite and
 * challenge pickers use (the app asks for 50 at a time):
 *
 *   MONGODB_DB=colleague_search_scratch npm run colleague-search:check
 *
 * A company where sixty names start with A and contain an "s": typing "s"
 * must put Satish and Rahul Singh first, and nothing typed must put the
 * viewer's own department first. Drops its own database and refuses any other.
 */
import { closeDb, connectDb, getDb, users } from '../config/db';
import { listColleagues } from '../services/game-challenge.service';

let failed = 0;
function check(name: string, ok: boolean, got?: unknown) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  → ${JSON.stringify(got)}`}`);
  if (!ok) failed += 1;
}
const ORG = 'search-scratch';
const person = (userId: string, name: string, extra: Record<string, unknown> = {}) => ({
  userId, name, email: `${userId}@sowaka.test`, org: ORG, lifecycleStatus: 'active', department: 'Sales', ...extra,
});

(async () => {
  await connectDb();
  const db = getDb();
  if (db.databaseName !== 'colleague_search_scratch') throw new Error(`refusing to run against ${db.databaseName}`);
  await db.dropDatabase();
  await connectDb();
  const aNames = Array.from({ length: 60 }, (_, i) => person(`a${i}`, `A${String(i).padStart(2, '0')}sh Kapoor`));
  await users().insertMany([
    person('me', 'Viewer Person', { department: 'Design' }),
    ...aNames,
    person('satish', 'Satish Kumar'),
    person('rahul', 'Rahul Singh'),
    person('zoya', 'Zoya Mehta', { department: 'Design' }),
    person('gone', 'Sam Left', { lifecycleStatus: 'offboarded' }),
  ] as never[]);
  const viewer = { userId: 'me', name: 'Viewer Person', email: 'me@sowaka.test', org: ORG };

  const typed = await listColleagues(viewer, 's', 50);
  check('typing "s": names starting with S come first', typed[0]?.name === 'Rahul Singh' || typed[0]?.name === 'Satish Kumar', typed.slice(0, 3).map((p) => p.name));
  check('both of them, before any contains-match', typed.slice(0, 2).map((p) => p.name).sort().join() === 'Rahul Singh,Satish Kumar', typed.slice(0, 3).map((p) => p.name));
  check('then the rest that contain it, up to 50', typed.length === 50, typed.length);
  check('never someone who has left', !typed.some((p) => p.name === 'Sam Left'));
  check('never the viewer', !typed.some((p) => p.userId === 'me'));
  const blank = await listColleagues(viewer, '', 50);
  check("nothing typed: the viewer's department first", blank[0]?.name === 'Zoya Mehta', blank.slice(0, 2).map((p) => p.name));
  check('then everyone else, 50 in all', blank.length === 50, blank.length);
  const full = await listColleagues(viewer, 'satish', 50);
  check('a full name finds that person', full.length === 1 && full[0].name === 'Satish Kumar', full);
  const odd = await listColleagues(viewer, 'a(', 50);
  check('a name with regex characters is searched as text', Array.isArray(odd) && odd.length === 0, odd.length);

  await db.dropDatabase();
  await closeDb();
  console.log(failed === 0 ? '\nall colleague-search checks passed' : `\n${failed} check(s) failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
